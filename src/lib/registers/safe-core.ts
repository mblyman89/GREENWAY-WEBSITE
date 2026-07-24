/**
 * src/lib/registers/safe-core.ts  (Feature slice 31 — master till / safe)
 *
 * PURE math and validation for the store safe (the $1,000 master change
 * fund). Zero I/O — unit-testable with tsx.
 *
 * Owner's policy: the safe holds $1,000 in change; a manager counts it
 * twice a day (morning and evening). Unlike drawer closes, safe counts are
 * OPEN, not blind — the target is known policy, so the manager sees the
 * live variance while counting. Register-side "swap" trips (big bills in,
 * equal change out) are value-neutral: zero net cash movement on both the
 * drawer and the safe, but every trip must leave a PIN-attributed,
 * manager-approved record.
 *
 * Money is always MINOR UNITS (cents) as integers. Denomination math is
 * shared via src/lib/registers/cash.ts (also pure).
 */

import { type DenomCounts, denomTotalMinor } from "@/lib/registers/cash";

// ---------------------------------------------------------------------------
// Policy constants
// ---------------------------------------------------------------------------

/** The safe's target float: $1,000.00 in cents (owner's stated policy). */
export const SAFE_TARGET_MINOR = 100_000;

/**
 * Single-swap cap: $2,000 in cents. A change swap bigger than double the
 * whole safe is a typo, not a swap.
 */
export const MAX_SWAP_MINOR = 200_000;

export const SAFE_NOTES_MAX_LEN = 500;

/** The owner's two daily counts, plus ad-hoc recounts. */
export type SafeCountWindow = "am" | "pm" | "other";

const COUNT_WINDOWS = new Set<SafeCountWindow>(["am", "pm", "other"]);

// ---------------------------------------------------------------------------
// Safe count validation
// ---------------------------------------------------------------------------

export type SafeCountInput = {
  window: SafeCountWindow;
  denoms: DenomCounts;
  /** Counted total, cents (derived from denoms). */
  totalMinor: number;
  /** Expected at count time, cents (snapshot of the target). */
  expectedMinor: number;
  /** total - expected (positive = over), cents. */
  varianceMinor: number;
  notes?: string;
};

export type SafeCountValidation = { ok: true; count: SafeCountInput } | { ok: false; error: string };

/**
 * Validate an untrusted safe-count submission into a typed SafeCountInput.
 * The total/expected/variance are DERIVED here (never trusted from the
 * caller) so a tampered form can't record a lying variance.
 */
export function validateSafeCount(body: {
  window?: unknown;
  denoms: DenomCounts;
  notes?: unknown;
}): SafeCountValidation {
  const window = String(body.window ?? "");
  if (!COUNT_WINDOWS.has(window as SafeCountWindow)) {
    return { ok: false, error: "Pick a count window (morning, evening, or other)." };
  }

  const totalMinor = denomTotalMinor(body.denoms);
  if (totalMinor <= 0) {
    return { ok: false, error: "Count at least one bill or coin — an empty safe count records nothing." };
  }

  const notesRaw = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notesRaw.length > SAFE_NOTES_MAX_LEN) {
    return { ok: false, error: `Notes must be ${SAFE_NOTES_MAX_LEN} characters or fewer.` };
  }

  const expectedMinor = SAFE_TARGET_MINOR;
  return {
    ok: true,
    count: {
      window: window as SafeCountWindow,
      denoms: body.denoms,
      totalMinor,
      expectedMinor,
      varianceMinor: totalMinor - expectedMinor,
      ...(notesRaw ? { notes: notesRaw } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Swap validation (shared by the till endpoint's request validator)
// ---------------------------------------------------------------------------

/**
 * Validate a swap amount in MINOR units. Swaps are value-neutral change
 * trades, so the only questions are: is it a positive whole number of
 * cents, and is it plausible?
 */
export function validateSwapAmount(raw: unknown): { ok: true; amountMinor: number } | { ok: false; error: string } {
  const amountMinor = Number(raw);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    return { ok: false, error: "Swap amount must be a positive whole number of cents." };
  }
  if (amountMinor > MAX_SWAP_MINOR) {
    return { ok: false, error: "Swap amount is implausibly large — check the number." };
  }
  return { ok: true, amountMinor };
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runSafeCoreTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`FAIL: ${msg}`);
    console.log(`PASS: ${msg}`);
  };

  const denoms = (d: Partial<DenomCounts>): DenomCounts => ({
    pennies: 0, nickels: 0, dimes: 0, quarters: 0, half_dollars: 0, dollar_coins: 0,
    ones: 0, twos: 0, fives: 0, tens: 0, twenties: 0, fifties: 0, hundreds: 0,
    ...d,
  });

  // policy constants
  ok(SAFE_TARGET_MINOR === 100_000, "target: the safe holds $1,000.00 (owner's policy)");
  ok(MAX_SWAP_MINOR === 200_000, "cap: single swap tops out at $2,000.00");

  // validateSafeCount — happy path, exactly on target
  const exact = validateSafeCount({ window: "am", denoms: denoms({ hundreds: 5, twenties: 25 }) });
  ok(exact.ok && exact.count.totalMinor === 100_000 && exact.count.varianceMinor === 0,
    "count: $500 in hundreds + $500 in twenties hits the $1,000 target exactly");
  ok(exact.ok && exact.count.expectedMinor === SAFE_TARGET_MINOR,
    "count: expected snapshots the target");

  // variance math is DERIVED, positive = over
  const over = validateSafeCount({ window: "pm", denoms: denoms({ hundreds: 10, ones: 3 }) });
  ok(over.ok && over.count.totalMinor === 100_300 && over.count.varianceMinor === 300,
    "count: $1,003.00 counted is over by $3.00 (variance derived, never trusted)");
  const short = validateSafeCount({ window: "pm", denoms: denoms({ hundreds: 9, twenties: 4 }) });
  ok(short.ok && short.count.totalMinor === 98_000 && short.count.varianceMinor === -2_000,
    "count: $980.00 counted is short by $20.00");

  // windows
  ok(validateSafeCount({ window: "other", denoms: denoms({ ones: 1 }) }).ok,
    "count: ad-hoc 'other' recount allowed");
  ok(!validateSafeCount({ window: "noon", denoms: denoms({ ones: 1 }) }).ok,
    "count: unknown window rejected");
  ok(!validateSafeCount({ window: "", denoms: denoms({ ones: 1 }) }).ok,
    "count: missing window rejected");

  // empty count rejected
  ok(!validateSafeCount({ window: "am", denoms: denoms({}) }).ok,
    "count: empty count rejected (records nothing)");

  // notes
  const noted = validateSafeCount({ window: "am", denoms: denoms({ ones: 1 }), notes: "  recount after swap  " });
  ok(noted.ok && noted.count.notes === "recount after swap", "count: notes trimmed and carried");
  ok(!validateSafeCount({ window: "am", denoms: denoms({ ones: 1 }), notes: "x".repeat(501) }).ok,
    "count: oversized notes rejected");
  const noNotes = validateSafeCount({ window: "am", denoms: denoms({ ones: 1 }) });
  ok(noNotes.ok && !("notes" in noNotes.count), "count: absent notes stay absent");

  // validateSwapAmount
  const swap = validateSwapAmount(10_000);
  ok(swap.ok && swap.amountMinor === 10_000, "swap: $100.00 change swap accepted");
  ok(!validateSwapAmount(0).ok, "swap: zero rejected (a $0 swap is not a swap)");
  ok(!validateSwapAmount(-500).ok, "swap: negatives rejected");
  ok(!validateSwapAmount(100.5).ok, "swap: non-integer cents rejected");
  ok(!validateSwapAmount(MAX_SWAP_MINOR + 1).ok, "swap: implausibly large rejected");
  ok(!validateSwapAmount("abc").ok, "swap: garbage rejected");
  ok(validateSwapAmount(MAX_SWAP_MINOR).ok, "swap: exactly the cap allowed");

  console.log("safe-core: 20 self-tests passed");
}
