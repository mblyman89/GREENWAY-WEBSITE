/**
 * src/lib/pos/cash-rounding-core.ts  (POS Slice B33)
 *
 * PURE cash-rounding math + owner config (no I/O, no React) — penny-free
 * cash handling the way Square and Toast ship it, constrained to the
 * WA Department of Revenue interim guidance (Feb 2026):
 *
 *   - Rounding is the RETAILER'S CHOICE: nearest nickel, always up, or
 *     always down. "off" keeps exact pennies.
 *   - Sales tax is computed on the PRE-ROUNDED price — rounding adjusts
 *     ONLY the cash amount due at the drawer, never the taxable total.
 *     The sale payload therefore keeps totalMinor/subtotalMinor/taxMinor
 *     exactly as priced; the adjustment travels as its OWN block.
 *   - The adjustment is a separate receipt line and day-report row
 *     (Square: "separate line on receipts and reports"; Toast: recorded
 *     as a non-taxable adjustment) so the books always show both numbers.
 *
 * Rounding table (nearest, matching Square's beta docs):
 *   .01/.02 → .00   .03/.04 → .05   .06/.07 → .05   .08/.09 → .10
 *
 * Money is MINOR UNITS (cents) throughout.
 */

export const CASH_ROUNDING_MODES = ["off", "nearest", "up", "down"] as const;
export type CashRoundingMode = (typeof CASH_ROUNDING_MODES)[number];

/** Owner config — one choice, stored as a site_settings JSON row. */
export type PosCashRoundingConfig = {
  /** How the cash amount due is rounded to the nickel. */
  mode: CashRoundingMode;
};

export const DEFAULT_POS_CASH_ROUNDING_CONFIG: PosCashRoundingConfig = { mode: "off" };

/** The nickel, in cents. */
export const NICKEL_MINOR = 5;

export function isCashRoundingMode(v: unknown): v is CashRoundingMode {
  return typeof v === "string" && (CASH_ROUNDING_MODES as readonly string[]).includes(v);
}

/**
 * Normalize an untrusted value (site_settings JSON, cached bundle, form
 * payload) into a safe config. Unknown/garbage input degrades to "off" —
 * the register never invents a rounding policy the owner didn't pick.
 */
export function normalizePosCashRoundingConfig(raw: unknown): PosCashRoundingConfig {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_POS_CASH_ROUNDING_CONFIG };
  }
  const o = raw as Record<string, unknown>;
  return { mode: isCashRoundingMode(o.mode) ? o.mode : "off" };
}

export type CashRoundingResult = {
  /** The cash amount due at the drawer AFTER rounding. */
  dueMinor: number;
  /** dueMinor − totalMinor. Negative = customer pays less; positive = more. */
  adjustmentMinor: number;
};

/**
 * Round a pre-rounded total to the cash amount due. Deterministic and
 * bounded: |adjustment| ≤ 4 cents. Returns null for invalid input (caller
 * refuses to tender rather than guessing).
 *
 * The TAXABLE total is NOT this function's business — WA DOR guidance keeps
 * tax on the pre-rounded price, so callers keep totalMinor untouched.
 */
export function roundCashDue(totalMinor: number, mode: CashRoundingMode): CashRoundingResult | null {
  if (!Number.isInteger(totalMinor) || totalMinor < 0) return null;
  if (mode === "off") return { dueMinor: totalMinor, adjustmentMinor: 0 };
  let dueMinor: number;
  if (mode === "nearest") dueMinor = Math.round(totalMinor / NICKEL_MINOR) * NICKEL_MINOR;
  else if (mode === "up") dueMinor = Math.ceil(totalMinor / NICKEL_MINOR) * NICKEL_MINOR;
  else dueMinor = Math.floor(totalMinor / NICKEL_MINOR) * NICKEL_MINOR;
  return { dueMinor, adjustmentMinor: dueMinor - totalMinor };
}

/** Human label for the owner-facing mode picker and receipts. */
export function cashRoundingModeLabel(mode: CashRoundingMode): string {
  switch (mode) {
    case "off":
      return "Off — exact pennies";
    case "nearest":
      return "Nearest nickel";
    case "up":
      return "Always round up";
    case "down":
      return "Always round down";
  }
}

// ---------------------------------------------------------------------------
// Self-tests (wired into scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runCashRoundingCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.error(`  FAIL cash-rounding-core: ${label}`);
    }
  };

  // Config normalization — garbage degrades to "off", never invents policy.
  ok(normalizePosCashRoundingConfig(null).mode === "off", "null → off");
  ok(normalizePosCashRoundingConfig("junk").mode === "off", "string → off");
  ok(normalizePosCashRoundingConfig([1]).mode === "off", "array → off");
  ok(normalizePosCashRoundingConfig({}).mode === "off", "empty object → off");
  ok(normalizePosCashRoundingConfig({ mode: "sideways" }).mode === "off", "unknown mode → off");
  ok(normalizePosCashRoundingConfig({ mode: "nearest" }).mode === "nearest", "nearest round-trips");
  ok(normalizePosCashRoundingConfig({ mode: "up" }).mode === "up", "up round-trips");
  ok(normalizePosCashRoundingConfig({ mode: "down" }).mode === "down", "down round-trips");

  // Off — identity.
  const off = roundCashDue(2926, "off");
  ok(off !== null && off.dueMinor === 2926 && off.adjustmentMinor === 0, "off leaves total untouched");

  // Nearest — full Square rounding table on the ones digit.
  const nearestTable: Array<[number, number]> = [
    [2920, 2920], // .00 → .00
    [2921, 2920], // .01 → .00
    [2922, 2920], // .02 → .00
    [2923, 2925], // .03 → .05
    [2924, 2925], // .04 → .05
    [2925, 2925], // .05 → .05
    [2926, 2925], // .06 → .05
    [2927, 2925], // .07 → .05
    [2928, 2930], // .08 → .10
    [2929, 2930], // .09 → .10
  ];
  for (const [total, expected] of nearestTable) {
    const r = roundCashDue(total, "nearest");
    ok(r !== null && r.dueMinor === expected, `nearest ${total} → ${expected}`);
    ok(r !== null && r.adjustmentMinor === expected - total, `nearest ${total} adjustment exact`);
  }

  // Up / down.
  const up = roundCashDue(2921, "up");
  ok(up !== null && up.dueMinor === 2925 && up.adjustmentMinor === 4, "up: .01 → .05 (+4)");
  ok(roundCashDue(2925, "up")?.adjustmentMinor === 0, "up: already-nickel total unchanged");
  const down = roundCashDue(2929, "down");
  ok(down !== null && down.dueMinor === 2925 && down.adjustmentMinor === -4, "down: .09 → .05 (−4)");
  ok(roundCashDue(2920, "down")?.adjustmentMinor === 0, "down: already-nickel total unchanged");

  // Bounds — |adjustment| never exceeds 4 cents in any mode.
  for (let cents = 0; cents < 100; cents += 1) {
    for (const mode of ["nearest", "up", "down"] as const) {
      const r = roundCashDue(1000 + cents, mode);
      if (r === null || Math.abs(r.adjustmentMinor) > 4 || r.dueMinor % NICKEL_MINOR !== 0) {
        ok(false, `bounds violated at ${1000 + cents} ${mode}`);
      }
    }
  }
  ok(true, "|adjustment| ≤ 4 and due lands on the nickel across a full cent cycle");

  // Invalid input refused — never guess a due amount.
  ok(roundCashDue(29.26, "nearest") === null, "non-integer total refused");
  ok(roundCashDue(-1, "nearest") === null, "negative total refused");
  ok(roundCashDue(0, "down")?.dueMinor === 0, "zero total stays zero");

  // Labels cover every mode.
  for (const mode of CASH_ROUNDING_MODES) {
    ok(cashRoundingModeLabel(mode).length > 0, `label exists for ${mode}`);
  }

  console.log(`cash-rounding-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`cash-rounding-core: ${fail} failure(s)`);
}
