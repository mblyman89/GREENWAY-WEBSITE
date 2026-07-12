/**
 * tests/compliance/customer-link-core.test.ts
 *
 * Task T / PR 4 — staff-confirmed customer↔order linking.
 * The core only RANKS candidates (phone+email > phone > email, exact
 * normalized matches only); linking is always a human action. These tests
 * pin the normalization and ranking rules so a refactor can't start
 * suggesting fuzzy (wrong-person) matches.
 */
import { describe, expect, it } from "vitest";
import {
  matchBasis,
  normalizeEmail,
  normalizePhoneDigits,
  rankCustomerMatches,
  type CustomerCandidate,
} from "@/lib/orders/customer-link-core";

function candidate(over: Partial<CustomerCandidate> = {}): CustomerCandidate {
  return {
    id: "c1",
    firstName: "Jamie",
    lastName: "Rivera",
    phoneNormalized: "3605551234",
    email: "jamie@example.com",
    ...over,
  };
}

describe("normalization mirrors customers/store.ts", () => {
  it("phone strips ALL non-digits (matches normalizePhone in customers/store)", () => {
    expect(normalizePhoneDigits("(360) 555-1234")).toBe("3605551234");
    expect(normalizePhoneDigits("+1 360.555.1234")).toBe("13605551234");
    expect(normalizePhoneDigits("   ")).toBeNull();
    expect(normalizePhoneDigits(null)).toBeNull();
    expect(normalizePhoneDigits("abc")).toBeNull();
  });

  it("email lowercases and trims", () => {
    expect(normalizeEmail("  Jamie@Example.COM ")).toBe("jamie@example.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe("matchBasis — exact matches only", () => {
  const order = { phone: "(360) 555-1234", email: "Jamie@Example.com" };

  it("phone + email → strongest basis", () => {
    expect(matchBasis(order, candidate())).toBe("phone_and_email");
  });

  it("phone only", () => {
    expect(matchBasis(order, candidate({ email: "other@example.com" }))).toBe("phone");
  });

  it("email only (case-insensitive)", () => {
    expect(matchBasis(order, candidate({ phoneNormalized: "9998887777" }))).toBe("email");
  });

  it("no match → null (no fuzzy matching, ever)", () => {
    expect(
      matchBasis(order, candidate({ phoneNormalized: "9998887777", email: "other@example.com" })),
    ).toBeNull();
    // Near-miss phone (one digit off) must NOT match.
    expect(matchBasis(order, candidate({ phoneNormalized: "3605551235", email: null }))).toBeNull();
  });

  it("missing order contact info never matches empty candidate fields", () => {
    // Order without phone/email cannot match a customer that also lacks them —
    // null === null must NOT count as a match.
    expect(
      matchBasis({ phone: null, email: null }, candidate({ phoneNormalized: null, email: null })),
    ).toBeNull();
    expect(
      matchBasis({ phone: "", email: "" }, candidate({ phoneNormalized: null, email: null })),
    ).toBeNull();
  });
});

describe("rankCustomerMatches — best-first, human decides", () => {
  const order = { phone: "360-555-1234", email: "jamie@example.com" };

  it("orders phone_and_email > phone > email and drops non-matches", () => {
    const ranked = rankCustomerMatches(order, [
      candidate({ id: "email-only", phoneNormalized: "111", email: "jamie@example.com" }),
      candidate({ id: "no-match", phoneNormalized: "111", email: "zz@example.com" }),
      candidate({ id: "both", phoneNormalized: "3605551234", email: "jamie@example.com" }),
      candidate({ id: "phone-only", phoneNormalized: "3605551234", email: null }),
    ]);
    expect(ranked.map((r) => r.customerId)).toEqual(["both", "phone-only", "email-only"]);
    expect(ranked[0]!.basis).toBe("phone_and_email");
    expect(ranked[0]!.basisLabel).toBe("Phone + email match");
    expect(ranked[1]!.basisLabel).toBe("Phone match");
    expect(ranked[2]!.basisLabel).toBe("Email match");
  });

  it("builds the display name from first + last", () => {
    const ranked = rankCustomerMatches(order, [
      candidate({ id: "x", firstName: "Sam", lastName: null }),
    ]);
    expect(ranked[0]!.name).toBe("Sam");
    const ranked2 = rankCustomerMatches(order, [candidate({ id: "y" })]);
    expect(ranked2[0]!.name).toBe("Jamie Rivera");
  });

  it("empty candidate list → empty result", () => {
    expect(rankCustomerMatches(order, [])).toEqual([]);
  });
});
