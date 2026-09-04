/**
 * tests/compliance/otherwise-taken-intake.test.ts  (SLICE 17)
 *
 * The INTAKE half of the ten-unit limit: parseOtherwiseTakenClassification().
 *
 * The engine can only enforce WAC 314-55-095(1)(d)(i)(D) on products somebody
 * has actually classified. Because an unflagged suppository falls into the
 * 2016 g liquid bucket and is effectively UNLIMITED, the classification step is
 * not paperwork — it is the control that makes the limit real. These tests pin
 * the parser that stands between a reviewer's form post and the database.
 *
 * The parser deliberately REFUSES rather than coerces. Every rejection below
 * represents a way a reviewer could otherwise have silently disabled, or
 * silently mis-scaled, a statutory limit.
 */
import { describe, it, expect } from "vitest";
import { parseOtherwiseTakenClassification } from "@/lib/pos/fact-review-core";

describe("SLICE 17 — parseOtherwiseTakenClassification", () => {
  // ---------------------------------------------------------------- blank --
  it("blank input classifies nothing at all", () => {
    const r = parseOtherwiseTakenClassification("", "");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Not `false`, not `null` — ABSENT. The reviewer left the row alone, so the
    // existing value (whatever it is) must survive untouched.
    expect(r.facts).toEqual({});
  });

  it("rejects a value that is neither yes, no, nor blank", () => {
    const r = parseOtherwiseTakenClassification("maybe", "");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/yes, no, or left blank/i);
  });

  // ------------------------------------------------------------------ yes --
  it("YES requires the units-per-package count", () => {
    // Without a count we would store a flag and then multiply by a default of
    // 1, counting a box of six as ONE unit and under-counting the limit 6x.
    const r = parseOtherwiseTakenClassification("yes", "");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/how many/i);
  });

  it("YES with a count classifies and records the count", () => {
    const r = parseOtherwiseTakenClassification("yes", "6");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.facts.otherwiseTaken).toBe(true);
    expect(r.facts.unitsPerPackage).toBe(6);
  });

  it("a single-unit package is the ordinary case and is accepted", () => {
    const r = parseOtherwiseTakenClassification("yes", "1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.facts.otherwiseTaken).toBe(true);
    expect(r.facts.unitsPerPackage).toBe(1);
  });

  it("the whole statutory allowance in one package is still valid", () => {
    // Ten units in a single box is exactly the transaction limit, not over it.
    // The parser classifies; the ENGINE decides what fits in a cart.
    const r = parseOtherwiseTakenClassification("yes", "10");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.facts.unitsPerPackage).toBe(10);
  });

  it("a package larger than the whole limit is still recorded, not refused", () => {
    // A 12-count box is a lawful PRODUCT; it simply cannot be sold in one
    // transaction. Refusing to classify it would leave it unflagged — and an
    // unflagged suppository is the permissive state. So we must record it.
    const r = parseOtherwiseTakenClassification("yes", "12");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.facts.otherwiseTaken).toBe(true);
    expect(r.facts.unitsPerPackage).toBe(12);
  });

  // ------------------------------------------------------------------- no --
  it("NO records an explicit false, which is NOT the same as unclassified", () => {
    const r = parseOtherwiseTakenClassification("no", "");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.facts.otherwiseTaken).toBe(false);
    // An explicit "no" is what silences the suspicion warning. It must be
    // stored as false, never left absent.
    expect("otherwiseTaken" in r.facts).toBe(true);
  });

  // -------------------------------------------------- count validation ----
  it.each([
    ["six", "a word"],
    ["6mg", "a unit suffix"],
    ["0", "zero"],
    ["-3", "negative"],
    ["", "empty when yes"],
  ])("refuses %s (%s) rather than guessing", (raw) => {
    const r = parseOtherwiseTakenClassification("yes", raw);
    expect(r.ok).toBe(false);
  });

  it("refuses a fractional count", () => {
    // Half a suppository is not an individual consumable item (RCW 69.50.101).
    const r = parseOtherwiseTakenClassification("yes", "2.5");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/whole/i);
  });

  it("validates a bad count even when the flag itself is blank", () => {
    // The reviewer typed a count but forgot the dropdown. Silently discarding
    // the typo would teach them the field works when it does not.
    const r = parseOtherwiseTakenClassification("", "abc");
    expect(r.ok).toBe(false);
  });

  it("a count with no flag is recorded without inventing a classification", () => {
    const r = parseOtherwiseTakenClassification("", "6");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.facts.unitsPerPackage).toBe(6);
    // Crucially it must NOT infer otherwiseTaken from the presence of a count.
    expect("otherwiseTaken" in r.facts).toBe(false);
  });

  it("tolerates surrounding whitespace on both fields", () => {
    const r = parseOtherwiseTakenClassification("  yes  ", "  6  ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.facts.otherwiseTaken).toBe(true);
    expect(r.facts.unitsPerPackage).toBe(6);
  });

  // ------------------------------------------------- independence check ----
  it("never touches the low-THC facts", () => {
    // The two classifications are independent. A suppository review must not
    // clear or set the beverage fields as a side effect.
    const r = parseOtherwiseTakenClassification("yes", "6");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("lowThcLiquid" in r.facts).toBe(false);
    expect("unitThcMg" in r.facts).toBe(false);
  });
});
