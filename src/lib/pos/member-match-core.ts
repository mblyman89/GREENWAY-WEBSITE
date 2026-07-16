/**
 * src/lib/pos/member-match-core.ts  (Task AO-3)
 *
 * PURE matcher for "the ID scan auto-attaches the loyalty member". After the
 * ID gate PASSES on a scanned license, the register (online) sends the parsed
 * name + DOB to /api/pos/member-match; the server gathers candidate customers
 * and THIS module decides — with zero I/O — whether exactly one of them is
 * unambiguously the person standing at the counter.
 *
 * The matching rule is deliberately strict, because a WRONG attach is far
 * worse than NO attach (someone else's points, someone else's history on the
 * screen). A candidate matches only when ALL THREE hold:
 *
 *   1. birthdate === scanned DOB (exact YYYY-MM-DD; a customer record with
 *      no birthdate can never auto-match),
 *   2. normalized LAST name is identical (case, spaces, hyphens, apostrophes
 *      and diacritics ignored — "O'Brien" == "OBRIEN", "Van Dyke" == "VANDYKE"),
 *   3. normalized FIRST name is identical (first token only, so middle names
 *      on either side are ignored — but "MIKE" vs "MICHAEL" does NOT match;
 *      nicknames fall back to the manual lookup, by design).
 *
 * Exactly one survivor  -> match (attach).
 * Two or more survivors -> ambiguous (duplicate records — never guess).
 * Zero survivors        -> none (budtender can still look the member up).
 *
 * Privacy: matching happens SERVER-side; the register only ever receives the
 * same privacy-lean member hit B14 already returns (label + points + tier).
 * The DOB used here came off the physical card the budtender is holding.
 *
 * Unit-tested via __runMemberMatchCoreTests() (registered in the pure
 * self-test suite) and mirrored in tests/compliance/member-match-core.test.ts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What the register learned from the PASSING scan gate. */
export type ScannedIdentity = {
  /** AAMVA DAC/DCT — may include middle names; may be null on odd cards. */
  firstName: string | null;
  /** AAMVA DCS — family name. */
  lastName: string | null;
  /** DOB from the gate verdict, YYYY-MM-DD (the gate guarantees the shape). */
  dateOfBirth: string;
};

/** The minimum of a customers row the matcher needs. */
export type MatchCandidate = {
  id: string;
  first_name: string;
  last_name: string | null;
  /** yyyy-mm-dd text or null — null can NEVER auto-match. */
  birthdate: string | null;
};

export type MemberMatchResult =
  | { kind: "match"; customerId: string }
  | { kind: "ambiguous"; count: number }
  | { kind: "none" };

// ---------------------------------------------------------------------------
// Name normalization
// ---------------------------------------------------------------------------

/** Letters-only, uppercased, diacritics stripped: "O'Brien " -> "OBRIEN". */
function lettersOnly(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
}

/**
 * Normalize a LAST name for comparison — the WHOLE string collapses to
 * letters ("Van  Dyke" -> "VANDYKE", "SMITH-JONES" -> "SMITHJONES").
 */
export function normalizeLastName(raw: string | null | undefined): string {
  if (!raw) return "";
  return lettersOnly(raw);
}

/**
 * Normalize a FIRST name for comparison — FIRST whitespace token only, so a
 * middle name on either side ("MICHAEL JAMES" vs "Michael") never blocks the
 * match, then letters-only like the last name.
 */
export function normalizeFirstName(raw: string | null | undefined): string {
  if (!raw) return "";
  const firstToken = raw.trim().split(/\s+/)[0] ?? "";
  return lettersOnly(firstToken);
}

/** Strict YYYY-MM-DD (the only shape the gate verdict emits). */
function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Candidate birthdate normalized to its yyyy-mm-dd prefix (or ""). */
function candidateDob(raw: string | null): string {
  if (!raw) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
  return m ? m[1] : "";
}

// ---------------------------------------------------------------------------
// The matcher
// ---------------------------------------------------------------------------

/**
 * Decide whether exactly ONE candidate is unambiguously the scanned person.
 * Partial identities (missing first OR last name OR malformed DOB) never
 * match anything — the register just skips the auto-attach.
 */
export function matchScannedCustomer(
  scan: ScannedIdentity,
  candidates: readonly MatchCandidate[],
): MemberMatchResult {
  const first = normalizeFirstName(scan.firstName);
  const last = normalizeLastName(scan.lastName);
  const dob = scan.dateOfBirth.trim();
  if (!first || !last || !isYmd(dob)) return { kind: "none" };

  const survivors = candidates.filter(
    (c) =>
      candidateDob(c.birthdate) === dob &&
      normalizeLastName(c.last_name) === last &&
      normalizeFirstName(c.first_name) === first,
  );

  if (survivors.length === 1) return { kind: "match", customerId: survivors[0].id };
  if (survivors.length > 1) return { kind: "ambiguous", count: survivors.length };
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runMemberMatchCoreTests(): void {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  const jane: MatchCandidate = { id: "c1", first_name: "Jane", last_name: "Doe", birthdate: "1990-04-12" };
  const john: MatchCandidate = { id: "c2", first_name: "John", last_name: "Doe", birthdate: "1990-04-12" };
  const scanJane: ScannedIdentity = { firstName: "JANE", lastName: "DOE", dateOfBirth: "1990-04-12" };

  // Happy path: exact name + DOB attaches.
  let r = matchScannedCustomer(scanJane, [jane, john]);
  ok(r.kind === "match" && r.customerId === "c1", "exact first+last+dob matches the one customer");

  // Normalization: case, punctuation, diacritics, inner spaces.
  r = matchScannedCustomer(
    { firstName: "renée", lastName: "o'brien", dateOfBirth: "1988-01-02" },
    [{ id: "c3", first_name: "RENEE", last_name: "OBrien", birthdate: "1988-01-02" }],
  );
  ok(r.kind === "match", "diacritics + apostrophe + case are ignored");
  r = matchScannedCustomer(
    { firstName: "Ann", lastName: "VAN DYKE", dateOfBirth: "1975-09-30" },
    [{ id: "c4", first_name: "Ann", last_name: "VanDyke", birthdate: "1975-09-30" }],
  );
  ok(r.kind === "match", "spaces inside a last name are ignored");

  // Middle names: first TOKEN comparison on both sides.
  r = matchScannedCustomer(
    { firstName: "MICHAEL JAMES", lastName: "DOE", dateOfBirth: "1990-04-12" },
    [{ id: "c5", first_name: "Michael", last_name: "Doe", birthdate: "1990-04-12" }],
  );
  ok(r.kind === "match", "a middle name on the scan never blocks the match");

  // Nicknames DON'T match — wrong attach is worse than no attach.
  r = matchScannedCustomer(
    { firstName: "MICHAEL", lastName: "DOE", dateOfBirth: "1990-04-12" },
    [{ id: "c6", first_name: "Mike", last_name: "Doe", birthdate: "1990-04-12" }],
  );
  ok(r.kind === "none", "nickname (Mike vs Michael) falls back to manual lookup");

  // DOB is mandatory and exact.
  r = matchScannedCustomer(scanJane, [{ ...jane, birthdate: "1990-04-13" }]);
  ok(r.kind === "none", "a one-day DOB difference never matches");
  r = matchScannedCustomer(scanJane, [{ ...jane, birthdate: null }]);
  ok(r.kind === "none", "a customer with no birthdate can never auto-match");
  r = matchScannedCustomer(scanJane, [{ ...jane, birthdate: "1990-04-12T00:00:00Z" }]);
  ok(r.kind === "match", "a timestamped birthdate matches on its yyyy-mm-dd prefix");

  // Ambiguity: duplicate records are NEVER guessed between.
  r = matchScannedCustomer(scanJane, [jane, { ...jane, id: "c1-dup" }]);
  ok(r.kind === "ambiguous" && r.count === 2, "duplicate records -> ambiguous, no attach");

  // Partial identity refuses to match at all.
  r = matchScannedCustomer({ firstName: null, lastName: "DOE", dateOfBirth: "1990-04-12" }, [jane]);
  ok(r.kind === "none", "missing first name -> none");
  r = matchScannedCustomer({ firstName: "JANE", lastName: null, dateOfBirth: "1990-04-12" }, [jane]);
  ok(r.kind === "none", "missing last name -> none");
  r = matchScannedCustomer({ firstName: "JANE", lastName: "DOE", dateOfBirth: "04/12/1990" }, [jane]);
  ok(r.kind === "none", "malformed DOB -> none");

  // Empty candidate pool.
  r = matchScannedCustomer(scanJane, []);
  ok(r.kind === "none", "no candidates -> none");

  // Normalizers directly.
  ok(normalizeLastName(" Smith-Jones ") === "SMITHJONES", "last: hyphen + trim collapse");
  ok(normalizeFirstName("  mary ann ") === "MARY", "first: first token only");
  ok(normalizeFirstName(null) === "" && normalizeLastName(undefined) === "", "null/undefined -> empty");

  if (failed > 0) {
    throw new Error(`member-match-core self-tests: ${failed} failed (${passed} passed): ${failures.join("; ")}`);
  }
  console.log(`member-match-core self-tests: ${passed} passed`);
}
