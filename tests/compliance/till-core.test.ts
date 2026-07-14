/**
 * tests/compliance/till-core.test.ts  (POS Slice B21)
 *
 * Vitest mirror of the till-core self-tests: validation for the
 * register-side till endpoint (count-in / drop / blind close).
 */
import { describe, expect, it } from "vitest";
import {
  MAX_DENOM_COUNT,
  MAX_DROP_MINOR,
  dollarsToMinor,
  sanitizeDenoms,
  validateTillRequest,
  __runTillCoreTests,
} from "@/lib/pos/till-core";
import { denomTotalMinor } from "@/lib/registers/cash";

describe("till-core (POS B21)", () => {
  it("self-tests pass", () => {
    expect(() => __runTillCoreTests()).not.toThrow();
  });

  it("dollarsToMinor parses cashier input and rejects non-drops", () => {
    expect(dollarsToMinor("$1,250.50")).toBe(125050);
    expect(dollarsToMinor("120")).toBe(12000);
    expect(dollarsToMinor("")).toBeNull();
    expect(dollarsToMinor("0")).toBeNull();
    expect(dollarsToMinor("-5")).toBeNull();
    expect(dollarsToMinor("12.345")).toBeNull();
  });

  it("sanitizeDenoms clamps, floors, caps, and drops unknown keys", () => {
    const d = sanitizeDenoms({ twenties: "3", ones: 4.9, pennies: -5, bogus: 9, hundreds: 10_000_000 });
    expect(d.twenties).toBe(3);
    expect(d.ones).toBe(4);
    expect(d.pennies).toBe(0);
    expect(d.hundreds).toBe(MAX_DENOM_COUNT);
    expect("bogus" in d).toBe(false);
  });

  it("open requires a non-empty float; close may be zero (all cash dropped)", () => {
    const open = validateTillRequest({ action: "open", pin: "1234", denoms: { twenties: 5, ones: 10 } });
    expect(open.ok).toBe(true);
    if (open.ok) expect(denomTotalMinor((open.req as { denoms: Record<string, number> }).denoms)).toBe(11000);

    expect(validateTillRequest({ action: "open", pin: "1234", denoms: {} }).ok).toBe(false);
    expect(validateTillRequest({ action: "close", pin: "1234", denoms: {} }).ok).toBe(true);
  });

  it("drop validates amount (integer cents, positive, plausible), window, witness, notes", () => {
    const good = validateTillRequest({
      action: "drop",
      pin: "1234",
      amountMinor: 20000,
      window: "night",
      witnessPin: "5678",
      notes: "  end of night  ",
    });
    expect(good.ok).toBe(true);
    if (good.ok && good.req.action === "drop") {
      expect(good.req.witnessPin).toBe("5678");
      expect(good.req.notes).toBe("end of night");
    }
    expect(validateTillRequest({ action: "drop", pin: "1234", amountMinor: 0, window: "other" }).ok).toBe(false);
    expect(validateTillRequest({ action: "drop", pin: "1234", amountMinor: 100.5, window: "other" }).ok).toBe(false);
    expect(
      validateTillRequest({ action: "drop", pin: "1234", amountMinor: MAX_DROP_MINOR + 1, window: "other" }).ok,
    ).toBe(false);
    expect(validateTillRequest({ action: "drop", pin: "1234", amountMinor: 500, window: "morning" }).ok).toBe(false);
    expect(
      validateTillRequest({ action: "drop", pin: "1234", amountMinor: 500, window: "other", notes: "x".repeat(501) }).ok,
    ).toBe(false);
  });

  it("rejects missing PIN, null body, and register-side reconcile (manager-only, back office)", () => {
    expect(validateTillRequest({ action: "open", pin: "", denoms: { ones: 1 } }).ok).toBe(false);
    expect(validateTillRequest(null).ok).toBe(false);
    expect(validateTillRequest({ action: "reconcile", pin: "1234" }).ok).toBe(false);
  });
});
