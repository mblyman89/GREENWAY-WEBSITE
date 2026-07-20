/**
 * POS register menu — display name cleanup (Bug 2).
 *
 * Runs the full pure self-test suite, then pins the exact owner-reported case
 * (a card name with a baked-in "-7g" shown next to its real "3.5 g" chip) and
 * the safety rails: legitimate strain names with numbers are never touched,
 * the cleanup is idempotent, and a name that is ONLY a size is left unchanged.
 * Display-only + reversible — stored data (back office + website) is untouched.
 */
import { describe, expect, it } from "vitest";

import {
  __runMenuNameDisplayCoreTests,
  cleanCardDisplayName,
} from "@/lib/pos/menu-name-display-core";

describe("menu-name-display-core self-tests", () => {
  it("all pass", () => {
    expect(() => __runMenuNameDisplayCoreTests()).not.toThrow();
  });
});

describe("cleanCardDisplayName", () => {
  it("strips the owner's baked-in trailing size from the card name", () => {
    expect(cleanCardDisplayName("SPR - Sour Diesel -7g", "3.5 g")).toBe("SPR - Sour Diesel");
    expect(cleanCardDisplayName("Blue Dream 3.5g", "3.5 g")).toBe("Blue Dream");
  });

  it("never touches a legitimate strain name (numbers in the identity)", () => {
    expect(cleanCardDisplayName("AK-47")).toBe("AK-47");
    expect(cleanCardDisplayName("9 Pound Hammer")).toBe("9 Pound Hammer");
    expect(cleanCardDisplayName("Girl Scout Cookies")).toBe("Girl Scout Cookies");
  });

  it("is idempotent and never strips to nothing", () => {
    const once = cleanCardDisplayName("SPR - Sour Diesel -7g");
    expect(cleanCardDisplayName(once)).toBe(once);
    expect(cleanCardDisplayName("3.5g")).toBe("3.5g");
    expect(cleanCardDisplayName("")).toBe("");
  });
});
