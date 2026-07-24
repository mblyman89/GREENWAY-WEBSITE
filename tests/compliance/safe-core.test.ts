/**
 * tests/compliance/safe-core.test.ts  (Feature slice 31)
 *
 * Vitest mirror of the safe-core self-tests: pure validation for the store
 * safe — the $1,000 master change fund with twice-daily manager counts and
 * value-neutral register change swaps.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_SWAP_MINOR,
  SAFE_TARGET_MINOR,
  validateSafeCount,
  validateSwapAmount,
  __runSafeCoreTests,
} from "@/lib/registers/safe-core";
import { type DenomCounts } from "@/lib/registers/cash";

function denoms(d: Partial<DenomCounts>): DenomCounts {
  return {
    pennies: 0, nickels: 0, dimes: 0, quarters: 0, half_dollars: 0, dollar_coins: 0,
    ones: 0, twos: 0, fives: 0, tens: 0, twenties: 0, fifties: 0, hundreds: 0,
    ...d,
  };
}

describe("safe-core (slice 31)", () => {
  it("self-tests pass", () => {
    expect(() => __runSafeCoreTests()).not.toThrow();
  });

  it("policy constants: $1,000 target, $2,000 single-swap cap", () => {
    expect(SAFE_TARGET_MINOR).toBe(100_000);
    expect(MAX_SWAP_MINOR).toBe(200_000);
  });

  it("validateSafeCount derives total/expected/variance (never trusted from the caller)", () => {
    const exact = validateSafeCount({ window: "am", denoms: denoms({ hundreds: 5, twenties: 25 }) });
    expect(exact.ok).toBe(true);
    if (exact.ok) {
      expect(exact.count.totalMinor).toBe(100_000);
      expect(exact.count.expectedMinor).toBe(SAFE_TARGET_MINOR);
      expect(exact.count.varianceMinor).toBe(0);
    }

    const over = validateSafeCount({ window: "pm", denoms: denoms({ hundreds: 10, ones: 3 }) });
    expect(over.ok).toBe(true);
    if (over.ok) expect(over.count.varianceMinor).toBe(300);

    const short = validateSafeCount({ window: "pm", denoms: denoms({ hundreds: 9, twenties: 4 }) });
    expect(short.ok).toBe(true);
    if (short.ok) expect(short.count.varianceMinor).toBe(-2_000);
  });

  it("validateSafeCount rejects unknown windows and empty counts", () => {
    expect(validateSafeCount({ window: "other", denoms: denoms({ ones: 1 }) }).ok).toBe(true);
    expect(validateSafeCount({ window: "noon", denoms: denoms({ ones: 1 }) }).ok).toBe(false);
    expect(validateSafeCount({ window: "", denoms: denoms({ ones: 1 }) }).ok).toBe(false);
    expect(validateSafeCount({ window: "am", denoms: denoms({}) }).ok).toBe(false);
  });

  it("validateSafeCount trims notes, rejects oversized ones, keeps absent notes absent", () => {
    const noted = validateSafeCount({ window: "am", denoms: denoms({ ones: 1 }), notes: "  recount after swap  " });
    expect(noted.ok).toBe(true);
    if (noted.ok) expect(noted.count.notes).toBe("recount after swap");

    expect(validateSafeCount({ window: "am", denoms: denoms({ ones: 1 }), notes: "x".repeat(501) }).ok).toBe(false);

    const noNotes = validateSafeCount({ window: "am", denoms: denoms({ ones: 1 }) });
    expect(noNotes.ok).toBe(true);
    if (noNotes.ok) expect("notes" in noNotes.count).toBe(false);
  });

  it("validateSwapAmount: positive integer cents up to the cap", () => {
    const swap = validateSwapAmount(10_000);
    expect(swap.ok).toBe(true);
    if (swap.ok) expect(swap.amountMinor).toBe(10_000);

    expect(validateSwapAmount(MAX_SWAP_MINOR).ok).toBe(true);
    expect(validateSwapAmount(0).ok).toBe(false);
    expect(validateSwapAmount(-500).ok).toBe(false);
    expect(validateSwapAmount(100.5).ok).toBe(false);
    expect(validateSwapAmount(MAX_SWAP_MINOR + 1).ok).toBe(false);
    expect(validateSwapAmount("abc").ok).toBe(false);
  });
});
