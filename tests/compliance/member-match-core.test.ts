/**
 * Task AO-3 — vitest mirror for the scan-to-member matcher.
 *
 * Runs the full self-test suite, then pins the behaviors the register (and
 * the /api/pos/member-match endpoint) depend on: an attach happens ONLY on
 * an exact, unambiguous first+last+DOB match; duplicates and near-misses
 * NEVER attach; and normalization forgives formatting, not identity.
 */
import { describe, expect, it } from "vitest";

import {
  __runMemberMatchCoreTests,
  matchScannedCustomer,
  normalizeFirstName,
  normalizeLastName,
  type MatchCandidate,
} from "@/lib/pos/member-match-core";

describe("member-match-core self-tests", () => {
  it("all pass", () => {
    expect(() => __runMemberMatchCoreTests()).not.toThrow();
  });
});

const jane: MatchCandidate = { id: "c1", first_name: "Jane", last_name: "Doe", birthdate: "1990-04-12" };

describe("matchScannedCustomer", () => {
  it("attaches on an exact, unambiguous first+last+DOB match", () => {
    const r = matchScannedCustomer(
      { firstName: "JANE", lastName: "DOE", dateOfBirth: "1990-04-12" },
      [jane, { id: "c2", first_name: "John", last_name: "Doe", birthdate: "1990-04-12" }],
    );
    expect(r).toEqual({ kind: "match", customerId: "c1" });
  });

  it("reports duplicates as ambiguous — never guesses between records", () => {
    const r = matchScannedCustomer(
      { firstName: "JANE", lastName: "DOE", dateOfBirth: "1990-04-12" },
      [jane, { ...jane, id: "c1-dup" }],
    );
    expect(r).toEqual({ kind: "ambiguous", count: 2 });
  });

  it("a missing customer birthdate can never auto-match", () => {
    const r = matchScannedCustomer(
      { firstName: "JANE", lastName: "DOE", dateOfBirth: "1990-04-12" },
      [{ ...jane, birthdate: null }],
    );
    expect(r.kind).toBe("none");
  });

  it("nicknames do not match — wrong attach is worse than no attach", () => {
    const r = matchScannedCustomer(
      { firstName: "MICHAEL", lastName: "DOE", dateOfBirth: "1990-04-12" },
      [{ id: "c6", first_name: "Mike", last_name: "Doe", birthdate: "1990-04-12" }],
    );
    expect(r.kind).toBe("none");
  });

  it("middle names on the scan are ignored (first-token comparison)", () => {
    const r = matchScannedCustomer(
      { firstName: "JANE MARIE", lastName: "DOE", dateOfBirth: "1990-04-12" },
      [jane],
    );
    expect(r.kind).toBe("match");
  });

  it("a partial identity (no first or last name, bad DOB shape) never matches", () => {
    expect(matchScannedCustomer({ firstName: null, lastName: "DOE", dateOfBirth: "1990-04-12" }, [jane]).kind).toBe("none");
    expect(matchScannedCustomer({ firstName: "JANE", lastName: null, dateOfBirth: "1990-04-12" }, [jane]).kind).toBe("none");
    expect(matchScannedCustomer({ firstName: "JANE", lastName: "DOE", dateOfBirth: "04/12/1990" }, [jane]).kind).toBe("none");
  });
});

describe("name normalization", () => {
  it("forgives case, punctuation, diacritics, and inner spaces", () => {
    expect(normalizeLastName("o'brien")).toBe("OBRIEN");
    expect(normalizeLastName("Van  Dyke")).toBe("VANDYKE");
    expect(normalizeLastName("Smith-Jones")).toBe("SMITHJONES");
    expect(normalizeFirstName("renée")).toBe("RENEE");
  });

  it("first name compares on the first token only", () => {
    expect(normalizeFirstName("Mary Ann")).toBe("MARY");
  });

  it("null/undefined normalize to empty (which never matches)", () => {
    expect(normalizeFirstName(null)).toBe("");
    expect(normalizeLastName(undefined)).toBe("");
  });
});
