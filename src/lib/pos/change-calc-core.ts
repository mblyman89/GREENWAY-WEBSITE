/**
 * src/lib/pos/change-calc-core.ts
 *
 * PURE denomination-aware change calculator for the POS (Slice B31).
 * No I/O, no React — safe for the tsx self-test harness and vitest.
 *
 * Greenway is CASH-ONLY, so counting change back fast and right is the
 * whole payment experience. Two helpers:
 *
 *  1. `changeBreakdown(changeMinor)` — the exact bills and coins to hand
 *     back, fewest pieces first. Greedy is PROVABLY optimal for the US
 *     canonical coin/bill system. The breakdown uses the CHANGE-MAKING
 *     set every US drawer actually gives from (twenties down to pennies)
 *     — $50s/$100s are taken in but not given back, and $2 bills,
 *     half-dollars, and dollar coins are counted in the till (B21's 13
 *     denominations) but never planned into change.
 *
 *  2. `smartTenderSuggestions(totalMinor)` — the amounts a customer
 *     actually hands over: exact, the next whole dollar, then the next
 *     $5/$10/$20 steps and the $50/$100 bills, deduplicated in ascending
 *     order. Feeds the tender screen's quick chips so one tap covers the
 *     overwhelming majority of real tenders.
 *
 * Money is in MINOR UNITS (cents) everywhere, matching the rest of the app.
 */

export type ChangeDenom = {
  /** Value in cents. */
  minor: number;
  /** Short label as spoken at the counter ("$20", "25¢"). */
  label: string;
  kind: "bill" | "coin";
};

/**
 * The change-making set, largest first — what a US register hands BACK.
 * Deliberately excludes $100/$50 (accepted, not returned), $2 bills,
 * half-dollars, and dollar coins (till-countable but never change-planned).
 */
export const CHANGE_DENOMS: readonly ChangeDenom[] = [
  { minor: 2000, label: "$20", kind: "bill" },
  { minor: 1000, label: "$10", kind: "bill" },
  { minor: 500, label: "$5", kind: "bill" },
  { minor: 100, label: "$1", kind: "bill" },
  { minor: 25, label: "25¢", kind: "coin" },
  { minor: 10, label: "10¢", kind: "coin" },
  { minor: 5, label: "5¢", kind: "coin" },
  { minor: 1, label: "1¢", kind: "coin" },
] as const;

export type ChangePart = {
  label: string;
  kind: "bill" | "coin";
  count: number;
  /** Total cents this row represents (count × denom). */
  minor: number;
};

/**
 * Break `changeMinor` into the fewest bills and coins (greedy — optimal for
 * US denominations). Returns [] for zero change; null for negative or
 * non-integer input (caller renders nothing rather than a wrong plan).
 */
export function changeBreakdown(changeMinor: number): ChangePart[] | null {
  if (!Number.isInteger(changeMinor) || changeMinor < 0) return null;
  const parts: ChangePart[] = [];
  let remaining = changeMinor;
  for (const d of CHANGE_DENOMS) {
    if (remaining <= 0) break;
    const count = Math.floor(remaining / d.minor);
    if (count > 0) {
      parts.push({ label: d.label, kind: d.kind, count, minor: count * d.minor });
      remaining -= count * d.minor;
    }
  }
  // The set ends at 1¢ so remaining is always 0 for valid input; belt and
  // suspenders: refuse to return a plan that doesn't add up.
  if (remaining !== 0) return null;
  return parts;
}

/** "1×$20 · 3×$1 · 2×25¢" — the count-back line as spoken at the counter. */
export function formatChangeBreakdown(parts: ChangePart[]): string {
  return parts.map((p) => `${p.count}×${p.label}`).join(" · ");
}

/**
 * Tender amounts a customer actually hands over for `totalMinor`, ascending
 * and deduplicated: exact, next whole dollar, next $5 step, next $10 step,
 * next $20 step, then the $50 and $100 bills when they cover the total.
 * Returns [] for invalid input. First entry is always the exact total.
 */
export function smartTenderSuggestions(totalMinor: number): number[] {
  if (!Number.isInteger(totalMinor) || totalMinor <= 0) return [];
  const candidates = [
    totalMinor,
    Math.ceil(totalMinor / 100) * 100,
    Math.ceil(totalMinor / 500) * 500,
    Math.ceil(totalMinor / 1000) * 1000,
    Math.ceil(totalMinor / 2000) * 2000,
  ];
  if (5000 >= totalMinor) candidates.push(5000);
  if (10000 >= totalMinor) candidates.push(10000);
  return [...new Set(candidates)].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Tender keypad (Task AL-B)
// ---------------------------------------------------------------------------

/**
 * Cap for a keypad-entered tender: $9,999.99. Fat-finger protection only —
 * far above any legal single transaction, far below an overflow.
 * (custom-sale-core's keypad caps at $999.99, which is right for a merch
 * line but too low for the cash a customer might put on the counter.)
 */
export const MAX_TENDER_MINOR = 999_999;

/**
 * Append one digit (0-9), register style: digits shift in from the right,
 * so 2-6-4-1 reads $26.41. Input past the cap or a bad digit is ignored;
 * invalid state resets to 0 first.
 */
export function tenderKeypadAppend(amountMinor: number, digit: number): number {
  const base = clampTender(amountMinor);
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return base;
  const next = base * 10 + digit;
  return next > MAX_TENDER_MINOR ? base : next;
}

/** Remove the rightmost digit. */
export function tenderKeypadBackspace(amountMinor: number): number {
  return Math.floor(clampTender(amountMinor) / 10);
}

function clampTender(amountMinor: number): number {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) return 0;
  return Math.min(amountMinor, MAX_TENDER_MINOR);
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runChangeCalcCoreTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) {
      console.log("FAIL:", msg);
      throw new Error(`change-calc-core self-test failed: ${msg}`);
    }
    pass += 1;
  };

  // changeBreakdown — canonical greedy results
  const b1 = changeBreakdown(2641); // $26.41 = 1×$20 1×$5 1×$1 1×25¢ 1×10¢ 1×5¢ 1×1¢
  ok(b1 !== null && b1.length === 7, "$26.41 breaks into 7 rows");
  ok(!!b1 && b1[0].label === "$20" && b1[0].count === 1, "$26.41 starts with 1×$20");
  ok(!!b1 && b1.reduce((s, p) => s + p.minor, 0) === 2641, "$26.41 parts sum exactly");

  const b2 = changeBreakdown(9900); // $99 = 4×$20 1×$10 1×$5 4×$1 (no $50s in change)
  ok(!!b2 && b2[0].label === "$20" && b2[0].count === 4, "$99 gives 4×$20 (never a $50)");
  ok(!!b2 && b2.every((p) => p.label !== "$50" && p.label !== "$100"), "$50/$100 never planned as change");

  const b3 = changeBreakdown(41); // 41¢ = 1×25 1×10 1×5 1×1
  ok(!!b3 && b3.length === 4 && b3.every((p) => p.kind === "coin"), "41¢ is 4 coin rows");
  ok(!!b3 && b3.reduce((s, p) => s + p.count, 0) === 4, "41¢ uses 4 coins (greedy optimal)");

  ok(changeBreakdown(0)?.length === 0, "zero change → empty plan (exact cash)");
  ok(changeBreakdown(-5) === null, "negative change refused");
  ok(changeBreakdown(10.5) === null, "fractional cents refused");

  // No $2/half-dollar/dollar-coin ever appears
  const b4 = changeBreakdown(350);
  ok(!!b4 && formatChangeBreakdown(b4) === "3×$1 · 2×25¢", "$3.50 = 3×$1 · 2×25¢ (no $2 bill, no half dollar)");

  // formatChangeBreakdown
  ok(formatChangeBreakdown([]) === "", "empty plan formats to empty string");
  const b5 = changeBreakdown(2100);
  ok(!!b5 && formatChangeBreakdown(b5) === "1×$20 · 1×$1", "$21 formats with middle dot");

  // smartTenderSuggestions
  const s1 = smartTenderSuggestions(2641); // $26.41
  ok(s1[0] === 2641, "first suggestion is always exact");
  ok(s1.includes(2700) && s1.includes(3000) && s1.includes(4000), "$26.41 → $27, $30, $40 steps");
  ok(s1.includes(5000) && s1.includes(10000), "$50 and $100 bills suggested when they cover");
  ok(s1.every((v, i) => i === 0 || v > s1[i - 1]), "suggestions strictly ascending");

  const s2 = smartTenderSuggestions(2000); // exactly $20
  ok(s2[0] === 2000 && new Set(s2).size === s2.length, "exact-bill total dedupes cleanly");

  const s3 = smartTenderSuggestions(15000); // $150 — beyond every bill
  ok(!s3.includes(5000) && !s3.includes(10000), "bills below the total never suggested");
  ok(s3.includes(16000), "next $20 step suggested above $100");

  ok(smartTenderSuggestions(0).length === 0, "zero total → no suggestions");
  ok(smartTenderSuggestions(-100).length === 0, "negative total → no suggestions");
  ok(smartTenderSuggestions(12.5).length === 0, "fractional total → no suggestions");

  // tenderKeypadAppend / tenderKeypadBackspace (AL-B)
  ok(tenderKeypadAppend(0, 2) === 2, "keypad: first digit");
  ok(tenderKeypadAppend(tenderKeypadAppend(tenderKeypadAppend(tenderKeypadAppend(0, 2), 6), 4), 1) === 2641, "keypad: 2-6-4-1 → $26.41");
  ok(tenderKeypadAppend(0, 0) === 0, "keypad: leading zero stays zero");
  ok(tenderKeypadAppend(MAX_TENDER_MINOR, 9) === MAX_TENDER_MINOR, "keypad: append past cap ignored");
  ok(tenderKeypadAppend(99_999_9, 9) === MAX_TENDER_MINOR, "keypad: at exactly the cap, append ignored");
  ok(tenderKeypadAppend(5, -1) === 5 && tenderKeypadAppend(5, 10) === 5, "keypad: bad digit ignored");
  ok(tenderKeypadAppend(-50, 3) === 3, "keypad: negative state resets before append");
  ok(tenderKeypadAppend(10.5, 3) === 3, "keypad: fractional state resets before append");
  ok(tenderKeypadBackspace(2641) === 264, "keypad: backspace drops rightmost digit");
  ok(tenderKeypadBackspace(0) === 0, "keypad: backspace at zero stays zero");
  ok(tenderKeypadBackspace(-7) === 0, "keypad: backspace on invalid state → 0");
  ok(MAX_TENDER_MINOR === 999_999, "keypad cap is $9,999.99");

  console.log(`change-calc-core self-tests: ALL PASS (${pass} assertions)`);
}
