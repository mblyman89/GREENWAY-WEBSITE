/**
 * tests/compliance/posting-core.test.ts
 *
 * Adversarial mirror for the F3 posting decision core — the logic behind THE ONE
 * DOOR into the general ledger.
 *
 * These tests are deliberately written to BREAK the core, not to confirm it
 * works (standing rule 13b). Every predicate is swept across its domain rather
 * than sampled at one happy value, because F2 shipped a "mirror check" that
 * passed for all 10,000 possible inputs and was therefore structurally incapable
 * of failing (standing rule 15b). Every assertion below has a negative control:
 * the wrong thing must be REFUSED, not merely the right thing accepted.
 *
 * The replays in the final block are Michael's actual historical failures
 * (standing rule 19). They are permanent. They never get deleted, because the
 * whole point of this platform is that those specific things can never happen
 * again.
 */
import { describe, it, expect } from "vitest";
import {
  SOURCE_KINDS,
  AUTOPOSTABLE_SOURCE_KINDS,
  NEVER_AUTOPOST_REASONS,
  isAutopostableSourceKind,
  buildIdempotencyKey,
  fingerprintLines,
  classifyIdempotency,
  isWithinTolerance,
  ZERO_TOLERANCE,
  decidePosting,
  requiresSecondApprover,
  canSelfApprove,
  assessTemplateReadiness,
  __runPostingCoreTests,
  type PostingTemplate,
  type PostingRequest,
  type SourceKind,
} from "../../src/lib/accounting/posting-core";

// ---------------------------------------------------------------------------
// Fixtures — a template that is valid in every respect, so that each test below
// can break exactly ONE thing and prove that one thing is what stopped it.
// ---------------------------------------------------------------------------

function goodTemplate(over: Partial<PostingTemplate> = {}): PostingTemplate {
  return {
    code: "UTIL-PSE",
    entityCode: "greenway",
    sourceKind: "bank",
    isActive: true,
    approvedBy: "michael",
    approvedAt: "2026-01-15T00:00:00Z",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    tolerance: { absCents: 500, milliPct: 1000 },
    maxAutoPostCents: 500_000,
    ...over,
  };
}

function goodRequest(over: Partial<PostingRequest> = {}): PostingRequest {
  return {
    entityCode: "greenway",
    sourceKind: "bank",
    sourceRef: "PSE-2026-10",
    journalDate: "2026-10-31",
    amountCents: 42_350,
    expectedCents: 42_350,
    templateCode: "UTIL-PSE",
    ...over,
  };
}

describe("posting-core: the module's own self-tests", () => {
  it("passes its embedded suite (the same one the CI gate runs)", () => {
    expect(() => __runPostingCoreTests()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 1) Which kinds may ever automate
// ---------------------------------------------------------------------------

describe("posting-core: the automation allowlist", () => {
  it("carries exactly the 16 source kinds in migration 0172's CHECK constraint", () => {
    expect(SOURCE_KINDS.length).toBe(16);
    expect(new Set(SOURCE_KINDS).size).toBe(16);
  });

  it("allows only four kinds to automate, and they are the evidence-derived ones", () => {
    expect([...AUTOPOSTABLE_SOURCE_KINDS].sort()).toEqual(
      ["bank", "excise", "pos_sale", "purchase"].sort(),
    );
  });

  it("refuses automation for EVERY judgment-based kind (full sweep, not a sample)", () => {
    const judgments: SourceKind[] = [
      "manual",
      "opening_balance",
      "payroll",
      "inventory",
      "loan",
      "crypto",
      "atm",
      "intercompany",
      "depreciation",
      "accrual",
      "close",
      "reversal",
    ];
    for (const k of judgments) {
      expect(isAutopostableSourceKind(k), `${k} must never auto-post`).toBe(false);
    }
    // Sweep: the two lists together must account for all 16, with no overlap.
    expect(judgments.length + AUTOPOSTABLE_SOURCE_KINDS.length).toBe(16);
  });

  it("has a written, human-readable reason on file for every refusal", () => {
    for (const k of SOURCE_KINDS) {
      if (isAutopostableSourceKind(k)) continue;
      const why = NEVER_AUTOPOST_REASONS[k];
      expect(typeof why, `${k} needs a reason`).toBe("string");
      expect(why.length, `${k}'s reason must be a real sentence`).toBeGreaterThan(20);
    }
  });

  it("NEGATIVE CONTROL: the predicate can return true, so it is not stuck-false", () => {
    expect(isAutopostableSourceKind("pos_sale")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2) Idempotency key — the anti-double-post
// ---------------------------------------------------------------------------

describe("posting-core: idempotency key", () => {
  it("is stable and readable, so an auditor can see which event a journal came from", () => {
    expect(buildIdempotencyKey("greenway", "pos_sale", "S-1001")).toBe(
      "greenway:pos_sale:S-1001",
    );
  });

  it("normalises casing and whitespace so a retry cannot dodge the key", () => {
    const a = buildIdempotencyKey("greenway", "pos_sale", "S-1001");
    const b = buildIdempotencyKey("  GREENWAY ", " Pos_Sale  ", "  S-1001 ");
    expect(b).toBe(a);
  });

  it("REFUSES a blank source reference rather than inventing one", () => {
    // Inventing a reference would mean every retry looks like a new event —
    // which is precisely the duplicate-posting bug the key exists to stop.
    for (const bad of ["", "   ", "\t", "\n"]) {
      expect(() => buildIdempotencyKey("greenway", "bank", bad)).toThrow(
        /GL_NO_IDEMPOTENCY_KEY/,
      );
    }
    expect(() => buildIdempotencyKey("", "bank", "X")).toThrow(/GL_NO_IDEMPOTENCY_KEY/);
    expect(() => buildIdempotencyKey("greenway", "", "X")).toThrow(/GL_NO_IDEMPOTENCY_KEY/);
  });

  it("cannot be forged by smuggling a colon into a component", () => {
    // "a:b" + "c" must not collide with "a" + "b:c".
    expect(buildIdempotencyKey("greenway", "bank", "a:b")).not.toBe(
      buildIdempotencyKey("greenway", "bank:a", "b"),
    );
    expect(buildIdempotencyKey("greenway", "bank", "a\\:b")).not.toBe(
      buildIdempotencyKey("greenway", "bank", "a:b"),
    );
  });

  it("SWEEP: 500 distinct references produce 500 distinct keys (no collisions)", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 500; i++) {
      keys.add(buildIdempotencyKey("greenway", "bank", `INV-${i}`));
    }
    expect(keys.size).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 3) Fingerprint + duplicate vs conflict
// ---------------------------------------------------------------------------

describe("posting-core: fingerprint and the duplicate/conflict decision", () => {
  const lines = [
    { accountCode: "10100", amountCents: 100_000 },
    { accountCode: "50010", amountCents: -100_000 },
  ];

  it("ignores line order, because order is an accident of iteration", () => {
    expect(fingerprintLines(lines)).toBe(fingerprintLines([...lines].reverse()));
  });

  it("DOES change when the amount changes (negative control on the fingerprint)", () => {
    const tweaked = [
      { accountCode: "10100", amountCents: 100_001 },
      { accountCode: "50010", amountCents: -100_001 },
    ];
    expect(fingerprintLines(tweaked)).not.toBe(fingerprintLines(lines));
  });

  it("DOES change when the account changes", () => {
    const tweaked = [
      { accountCode: "10110", amountCents: 100_000 },
      { accountCode: "50010", amountCents: -100_000 },
    ];
    expect(fingerprintLines(tweaked)).not.toBe(fingerprintLines(lines));
  });

  it("DOES change when only the 280E cost class changes", () => {
    // Same money, different tax treatment. If this collided, someone could
    // re-tag an expense from nondeductible_280e to cogs_direct and the door
    // would call it a harmless duplicate. That is an audit loss.
    const a = [{ accountCode: "60010", amountCents: 5_000, costClass: "cogs_direct" }];
    const b = [{ accountCode: "60010", amountCents: 5_000, costClass: "nondeductible_280e" }];
    expect(fingerprintLines(a)).not.toBe(fingerprintLines(b));
  });

  it("refuses to fingerprint nothing, and refuses unsafe amounts", () => {
    expect(() => fingerprintLines([])).toThrow(/GL_NO_LINES/);
    expect(() =>
      fingerprintLines([{ accountCode: "10100", amountCents: 1.5 }]),
    ).toThrow(/GL_BAD_AMOUNT/);
    expect(() =>
      fingerprintLines([{ accountCode: "10100", amountCents: Number.MAX_SAFE_INTEGER + 2 }]),
    ).toThrow(/GL_BAD_AMOUNT/);
  });

  it("classifies fresh / duplicate / conflict — all three, with the right one each time", () => {
    const key = buildIdempotencyKey("greenway", "purchase", "INV-77");
    const fp = fingerprintLines(lines);

    expect(classifyIdempotency(key, fp, null)).toBe("fresh");
    expect(classifyIdempotency(key, fp, undefined)).toBe("fresh");
    expect(
      classifyIdempotency(key, fp, { idempotencyKey: key, lineFingerprint: fp }),
    ).toBe("duplicate");
    expect(
      classifyIdempotency(key, fp, {
        idempotencyKey: key,
        lineFingerprint: fingerprintLines([
          { accountCode: "10100", amountCents: 999_999 },
          { accountCode: "50010", amountCents: -999_999 },
        ]),
      }),
    ).toBe("conflict");
  });

  it("THE CONFLICT CASE: the same invoice number with a different amount is REFUSED", () => {
    // A vendor re-issuing invoice INV-77 for a different amount is either an
    // error or an after-the-fact edit. Returning the original hides it;
    // posting the new one double-counts it. Both are drift.
    const key = buildIdempotencyKey("greenway", "purchase", "INV-77");
    const original = fingerprintLines([{ accountCode: "20100", amountCents: 250_000 }]);
    const revised = fingerprintLines([{ accountCode: "20100", amountCents: 260_000 }]);
    expect(
      classifyIdempotency(key, revised, {
        idempotencyKey: key,
        lineFingerprint: original,
      }),
    ).toBe("conflict");
  });

  it("a DIFFERENT key is fresh even if the content happens to match", () => {
    const fp = fingerprintLines(lines);
    expect(
      classifyIdempotency("greenway:bank:A", fp, {
        idempotencyKey: "greenway:bank:B",
        lineFingerprint: fp,
      }),
    ).toBe("fresh");
  });
});

// ---------------------------------------------------------------------------
// 4) Tolerance — integer maths, boundaries, and the float trap
// ---------------------------------------------------------------------------

describe("posting-core: tolerance", () => {
  it("accepts an exact match under zero tolerance, and rejects one cent off", () => {
    expect(isWithinTolerance(10_000, 10_000, ZERO_TOLERANCE)).toBe(true);
    expect(isWithinTolerance(10_000, 10_001, ZERO_TOLERANCE)).toBe(false);
    expect(isWithinTolerance(10_000, 9_999, ZERO_TOLERANCE)).toBe(false);
  });

  it("BOUNDARY: the absolute allowance includes its edge and excludes one past it", () => {
    const tol = { absCents: 500, milliPct: 0 };
    expect(isWithinTolerance(100_000, 100_500, tol)).toBe(true); // exactly on
    expect(isWithinTolerance(100_000, 100_501, tol)).toBe(false); // one past
    expect(isWithinTolerance(100_000, 99_500, tol)).toBe(true); // symmetric below
    expect(isWithinTolerance(100_000, 99_499, tol)).toBe(false);
  });

  it("BOUNDARY: the percentage allowance is floored, never rounded up", () => {
    // 1.5% of 1001 cents = 15.015 cents. Floored, the allowance is 15, so a
    // 16-cent variance must be refused. A generous rounding here would let
    // variances through one cent at a time forever.
    const tol = { absCents: 0, milliPct: 1500 };
    expect(isWithinTolerance(1_001, 1_001 + 15, tol)).toBe(true);
    expect(isWithinTolerance(1_001, 1_001 + 16, tol)).toBe(false);
  });

  it("THE FLOAT TRAP: a nine-billion-dollar invoice does not lose precision", () => {
    // 900_000_000_000 cents * 100000 exceeds IEEE-754's exact integer range.
    // Computed in floating point the allowance drifts and a variance is
    // silently accepted. Standing rule 13e: BigInt or nothing.
    const expected = 900_000_000_000;
    const tol = { absCents: 0, milliPct: 1 }; // 0.001% => allowance exactly 9_000_000
    expect(isWithinTolerance(expected, expected + 9_000_000, tol)).toBe(true);
    expect(isWithinTolerance(expected, expected + 9_000_001, tol)).toBe(false);
  });

  it("either leg alone can admit a variance (both are live, neither is dead code)", () => {
    // Absolute leg alone.
    expect(isWithinTolerance(1_000, 1_400, { absCents: 500, milliPct: 0 })).toBe(true);
    // Percentage leg alone.
    expect(isWithinTolerance(1_000_000, 1_005_000, { absCents: 0, milliPct: 1000 })).toBe(true);
  });

  it("works on negative expected amounts (a credit memo is still a magnitude)", () => {
    expect(isWithinTolerance(-100_000, -100_400, { absCents: 500, milliPct: 0 })).toBe(true);
    expect(isWithinTolerance(-100_000, -100_600, { absCents: 500, milliPct: 0 })).toBe(false);
  });

  it("refuses nonsense tolerances rather than treating them as zero", () => {
    expect(() => isWithinTolerance(100, 100, { absCents: -1, milliPct: 0 })).toThrow(
      /GL_BAD_TOLERANCE/,
    );
    expect(() => isWithinTolerance(100, 100, { absCents: 0, milliPct: -1 })).toThrow(
      /GL_BAD_TOLERANCE/,
    );
    expect(() => isWithinTolerance(100, 100, { absCents: 1.5, milliPct: 0 })).toThrow(
      /GL_BAD_TOLERANCE/,
    );
    expect(() => isWithinTolerance(1.5, 100, ZERO_TOLERANCE)).toThrow(/GL_BAD_AMOUNT/);
    expect(() => isWithinTolerance(100, Number.NaN, ZERO_TOLERANCE)).toThrow(/GL_BAD_AMOUNT/);
    expect(() => isWithinTolerance(100, Number.POSITIVE_INFINITY, ZERO_TOLERANCE)).toThrow(
      /GL_BAD_AMOUNT/,
    );
  });

  it("SWEEP: across 0..2000 cents of variance the verdict flips exactly once", () => {
    // A predicate that is monotone and flips exactly once is a real gate. One
    // that never flips is a tautology (standing rule 15b).
    const tol = { absCents: 500, milliPct: 0 };
    let flips = 0;
    let prev = isWithinTolerance(100_000, 100_000, tol);
    for (let d = 1; d <= 2_000; d++) {
      const now = isWithinTolerance(100_000, 100_000 + d, tol);
      if (now !== prev) flips++;
      prev = now;
    }
    expect(flips).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5) decidePosting — the gate itself
// ---------------------------------------------------------------------------

describe("posting-core: decidePosting", () => {
  it("posts the clean, matched, in-tolerance, approved case", () => {
    const d = decidePosting(goodRequest(), goodTemplate());
    expect(d.disposition).toBe("post");
    expect(d.code).toBe("AUTOPOST_OK");
  });

  it("THE SWEEP THAT MATTERS: no source kind can post without a template", () => {
    // If any kind could slip through with a null template, the entire template
    // regime would be decorative.
    for (const kind of SOURCE_KINDS) {
      const d = decidePosting(
        goodRequest({ sourceKind: kind, templateCode: null, threeWayMatched: true }),
        null,
      );
      expect(d.disposition, `${kind} posted with no template`).not.toBe("post");
    }
  });

  it("THE SWEEP THAT MATTERS: no non-allowlisted kind can post even WITH a perfect template", () => {
    for (const kind of SOURCE_KINDS) {
      if (isAutopostableSourceKind(kind)) continue;
      const d = decidePosting(
        goodRequest({ sourceKind: kind, threeWayMatched: true }),
        goodTemplate({ sourceKind: kind }),
      );
      expect(d.disposition, `${kind} auto-posted`).toBe("draft");
      expect(d.code).toBe("AUTOPOST_NOT_ELIGIBLE");
    }
  });

  it("refuses impossible dates, including 31 February and 29 February in a common year", () => {
    for (const bad of ["2026-02-31", "2027-02-29", "2026-13-01", "2026-00-10", "not-a-date", ""]) {
      const d = decidePosting(goodRequest({ journalDate: bad }), goodTemplate());
      expect(d.disposition, `${bad} was accepted`).toBe("refuse");
      expect(d.code).toBe("GL_BAD_DATE");
    }
  });

  it("accepts a REAL leap day (negative control on the date check)", () => {
    const d = decidePosting(goodRequest({ journalDate: "2028-02-29" }), goodTemplate());
    expect(d.disposition).toBe("post");
  });

  it("refuses a zero-amount entry and non-integer cents", () => {
    expect(decidePosting(goodRequest({ amountCents: 0 }), goodTemplate()).code).toBe(
      "GL_ZERO_AMOUNT",
    );
    expect(decidePosting(goodRequest({ amountCents: 42.5 }), goodTemplate()).code).toBe(
      "GL_BAD_AMOUNT",
    );
    expect(decidePosting(goodRequest({ amountCents: Number.NaN }), goodTemplate()).code).toBe(
      "GL_BAD_AMOUNT",
    );
  });

  it("holds a purchase until the purchase order, receipt and invoice all agree", () => {
    const req = goodRequest({ sourceKind: "purchase", threeWayMatched: false });
    const d = decidePosting(req, goodTemplate({ sourceKind: "purchase" }));
    expect(d.disposition).toBe("draft");
    expect(d.code).toBe("AUTOPOST_NO_THREE_WAY_MATCH");

    // Absent (undefined) is treated exactly like false — never like true.
    const missing = goodRequest({ sourceKind: "purchase" });
    delete (missing as { threeWayMatched?: boolean }).threeWayMatched;
    expect(decidePosting(missing, goodTemplate({ sourceKind: "purchase" })).code).toBe(
      "AUTOPOST_NO_THREE_WAY_MATCH",
    );

    // NEGATIVE CONTROL: with the match present it does post.
    expect(
      decidePosting(
        goodRequest({ sourceKind: "purchase", threeWayMatched: true }),
        goodTemplate({ sourceKind: "purchase" }),
      ).disposition,
    ).toBe("post");
  });

  it("refuses a template belonging to the wrong entity", () => {
    // Booking a Greenway utility bill into the landholding books is exactly how
    // an S-corp return and a Schedule C get contaminated.
    const d = decidePosting(goodRequest(), goodTemplate({ entityCode: "landholding" }));
    expect(d.disposition).toBe("refuse");
    expect(d.code).toBe("AUTOPOST_WRONG_ENTITY");
  });

  it("refuses a template for the wrong source kind, and a mismatched template code", () => {
    expect(
      decidePosting(goodRequest(), goodTemplate({ sourceKind: "pos_sale" })).code,
    ).toBe("AUTOPOST_WRONG_SOURCE_KIND");
    expect(decidePosting(goodRequest(), goodTemplate({ code: "OTHER" })).code).toBe(
      "AUTOPOST_TEMPLATE_MISMATCH",
    );
  });

  it("will not fire a switched-off or never-approved template", () => {
    expect(decidePosting(goodRequest(), goodTemplate({ isActive: false })).code).toBe(
      "AUTOPOST_TEMPLATE_INACTIVE",
    );
    expect(decidePosting(goodRequest(), goodTemplate({ approvedBy: null })).code).toBe(
      "AUTOPOST_TEMPLATE_UNAPPROVED",
    );
    expect(decidePosting(goodRequest(), goodTemplate({ approvedAt: null })).code).toBe(
      "AUTOPOST_TEMPLATE_UNAPPROVED",
    );
  });

  it("respects the effective window at both edges, inclusive", () => {
    const t = goodTemplate({ effectiveFrom: "2026-06-01", effectiveTo: "2026-06-30" });
    expect(decidePosting(goodRequest({ journalDate: "2026-05-31" }), t).code).toBe(
      "AUTOPOST_TEMPLATE_NOT_YET_EFFECTIVE",
    );
    expect(decidePosting(goodRequest({ journalDate: "2026-06-01" }), t).disposition).toBe("post");
    expect(decidePosting(goodRequest({ journalDate: "2026-06-30" }), t).disposition).toBe("post");
    expect(decidePosting(goodRequest({ journalDate: "2026-07-01" }), t).code).toBe(
      "AUTOPOST_TEMPLATE_EXPIRED",
    );
  });

  it("refuses a template whose own dates are unreadable", () => {
    expect(decidePosting(goodRequest(), goodTemplate({ effectiveFrom: "junk" })).code).toBe(
      "AUTOPOST_TEMPLATE_BAD_DATES",
    );
    expect(decidePosting(goodRequest(), goodTemplate({ effectiveTo: "2026-02-30" })).code).toBe(
      "AUTOPOST_TEMPLATE_BAD_DATES",
    );
  });

  it("enforces the hard ceiling at the edge, and refuses a missing or absurd ceiling", () => {
    const t = goodTemplate({ maxAutoPostCents: 100_000 });
    expect(decidePosting(goodRequest({ amountCents: 100_000, expectedCents: 100_000 }), t).disposition).toBe("post");
    expect(decidePosting(goodRequest({ amountCents: 100_001, expectedCents: 100_001 }), t).code).toBe(
      "AUTOPOST_OVER_LIMIT",
    );
    expect(decidePosting(goodRequest(), goodTemplate({ maxAutoPostCents: 0 })).code).toBe(
      "AUTOPOST_BAD_CEILING",
    );
    expect(decidePosting(goodRequest(), goodTemplate({ maxAutoPostCents: -1 })).code).toBe(
      "AUTOPOST_BAD_CEILING",
    );
  });

  it("the ceiling is on magnitude, so a huge NEGATIVE amount cannot slip under it", () => {
    const t = goodTemplate({ maxAutoPostCents: 100_000 });
    const d = decidePosting(
      goodRequest({ amountCents: -5_000_000, expectedCents: -5_000_000 }),
      t,
    );
    expect(d.disposition).not.toBe("post");
    expect(d.code).toBe("AUTOPOST_OVER_LIMIT");
  });

  it("drafts anything outside tolerance rather than posting it", () => {
    const d = decidePosting(
      goodRequest({ amountCents: 60_000, expectedCents: 42_350 }),
      goodTemplate(),
    );
    expect(d.disposition).toBe("draft");
    expect(d.code).toBe("AUTOPOST_OUT_OF_TOLERANCE");
  });

  it("EVERY decision carries a code and plain-English reason Michael can read", () => {
    const cases: Array<[PostingRequest, PostingTemplate | null]> = [
      [goodRequest(), goodTemplate()],
      [goodRequest({ journalDate: "bad" }), goodTemplate()],
      [goodRequest({ amountCents: 0 }), goodTemplate()],
      [goodRequest({ sourceKind: "accrual" }), goodTemplate({ sourceKind: "accrual" })],
      [goodRequest({ templateCode: null }), null],
      [goodRequest(), goodTemplate({ isActive: false })],
      [goodRequest({ amountCents: 9_999_999, expectedCents: 9_999_999 }), goodTemplate()],
    ];
    for (const [req, tpl] of cases) {
      const d = decidePosting(req, tpl);
      expect(["post", "draft", "refuse"]).toContain(d.disposition);
      expect(d.code.length).toBeGreaterThan(3);
      expect(d.reason.length, `reason too short for ${d.code}`).toBeGreaterThan(15);
    }
  });

  it("never throws, no matter how hostile the input — it decides", () => {
    // An unexpected exception inside a posting path is itself a hazard: the
    // caller cannot tell "refused" from "crashed", and a retry loop on a crash
    // is how money gets posted twice.
    const hostile: unknown[] = [
      { ...goodRequest(), journalDate: null },
      { ...goodRequest(), journalDate: 20261031 },
      { ...goodRequest(), amountCents: "42350" },
      { ...goodRequest(), sourceKind: "not_a_kind" },
      { ...goodRequest(), entityCode: "" },
      { ...goodRequest(), expectedCents: Number.NaN },
      { ...goodRequest(), sourceRef: "💀".repeat(500) },
    ];
    for (const h of hostile) {
      expect(() => decidePosting(h as PostingRequest, goodTemplate())).not.toThrow();
      expect(decidePosting(h as PostingRequest, goodTemplate()).disposition).toBeDefined();
    }
  });

  it("an unknown source kind is never posted (fails closed, not open)", () => {
    const d = decidePosting(
      { ...goodRequest(), sourceKind: "wire_transfer" as SourceKind },
      goodTemplate({ sourceKind: "wire_transfer" as SourceKind }),
    );
    expect(d.disposition).not.toBe("post");
  });
});

// ---------------------------------------------------------------------------
// 6) Segregation of duties
// ---------------------------------------------------------------------------

describe("posting-core: segregation of duties", () => {
  it("requires a second approver at the threshold and above, not merely above", () => {
    expect(requiresSecondApprover(499_999, 500_000)).toBe(false);
    expect(requiresSecondApprover(500_000, 500_000)).toBe(true);
    expect(requiresSecondApprover(500_001, 500_000)).toBe(true);
  });

  it("measures magnitude, so a large credit is not exempt", () => {
    expect(requiresSecondApprover(-500_000, 500_000)).toBe(true);
  });

  it("lets a different approver sign anything, and blocks self-approval of big entries", () => {
    expect(canSelfApprove("michael", "nicholas", 10_000_000, 500_000)).toBe(true);
    expect(canSelfApprove("michael", "michael", 100, 500_000)).toBe(true);
    expect(canSelfApprove("michael", "michael", 10_000_000, 500_000)).toBe(false);
  });

  it("a zero threshold means nothing is ever self-approved (the strictest setting works)", () => {
    expect(canSelfApprove("michael", "michael", 1, 0)).toBe(false);
  });

  it("rejects nonsense thresholds instead of silently disabling the control", () => {
    expect(() => requiresSecondApprover(100, -1)).toThrow(/GL_BAD_THRESHOLD/);
    expect(() => requiresSecondApprover(1.5, 100)).toThrow(/GL_BAD_AMOUNT/);
  });
});

// ---------------------------------------------------------------------------
// 7) Readiness — measured, reported, NEVER self-applied
// ---------------------------------------------------------------------------

describe("posting-core: template readiness", () => {
  it("reports no history as not eligible, and says so in plain English", () => {
    const r = assessTemplateReadiness({
      templateCode: "UTIL-PSE",
      matchedWithinTolerance: 0,
      exceptions: 0,
      distinctMonths: 0,
    });
    expect(r.eligibleForWidening).toBe(false);
    expect(r.successMilliPct).toBe(0);
    expect(r.recommendation).toMatch(/No history/i);
  });

  it("requires volume AND spread AND accuracy — each one alone is not enough", () => {
    // Volume + accuracy, but only one month.
    expect(
      assessTemplateReadiness({
        templateCode: "T",
        matchedWithinTolerance: 100,
        exceptions: 0,
        distinctMonths: 1,
      }).eligibleForWidening,
    ).toBe(false);
    // Spread + accuracy, but tiny volume.
    expect(
      assessTemplateReadiness({
        templateCode: "T",
        matchedWithinTolerance: 12,
        exceptions: 0,
        distinctMonths: 12,
      }).eligibleForWidening,
    ).toBe(false);
    // Volume + spread, but a poor record.
    expect(
      assessTemplateReadiness({
        templateCode: "T",
        matchedWithinTolerance: 90,
        exceptions: 10,
        distinctMonths: 12,
      }).eligibleForWidening,
    ).toBe(false);
  });

  it("NEGATIVE CONTROL: it CAN say yes, so the bar is reachable and not a tautology", () => {
    const r = assessTemplateReadiness({
      templateCode: "T",
      matchedWithinTolerance: 100,
      exceptions: 0,
      distinctMonths: 12,
    });
    expect(r.eligibleForWidening).toBe(true);
    expect(r.successMilliPct).toBe(100_000);
  });

  it("BOUNDARY: 98% passes, one exception short of it does not", () => {
    const at98 = assessTemplateReadiness({
      templateCode: "T",
      matchedWithinTolerance: 98,
      exceptions: 2,
      distinctMonths: 6,
    });
    expect(at98.successMilliPct).toBe(98_000);
    expect(at98.eligibleForWidening).toBe(true);

    const below = assessTemplateReadiness({
      templateCode: "T",
      matchedWithinTolerance: 97,
      exceptions: 3,
      distinctMonths: 6,
    });
    expect(below.successMilliPct).toBe(97_000);
    expect(below.eligibleForWidening).toBe(false);
  });

  it("THE PUSHBACK, ENCODED: eligibility is advice — it never returns a new tolerance", () => {
    // Michael asked for controls that loosen themselves once the system has
    // learned the patterns. A system that widens its own tolerance on the
    // strength of its own record is grading its own homework. So the assessment
    // object must contain NO tolerance, NO new limit, nothing a caller could
    // apply automatically — only a number to display and a sentence to read.
    const r = assessTemplateReadiness({
      templateCode: "T",
      matchedWithinTolerance: 500,
      exceptions: 0,
      distinctMonths: 24,
    });
    expect(Object.keys(r).sort()).toEqual(
      ["eligibleForWidening", "recommendation", "successMilliPct", "templateCode"].sort(),
    );
    expect(r.recommendation).toMatch(/you have to change it yourself/i);
  });

  it("survives garbage history without inventing eligibility", () => {
    const r = assessTemplateReadiness({
      templateCode: "T",
      matchedWithinTolerance: -5,
      exceptions: -5,
      distinctMonths: -5,
    });
    expect(r.eligibleForWidening).toBe(false);
    expect(r.successMilliPct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8) REPLAYS OF MICHAEL'S ACTUAL HISTORICAL FAILURES (standing rule 19)
// These are permanent. They are the reason this platform exists.
// ---------------------------------------------------------------------------

describe("posting-core: replays of the real failures that caused the Sage drift", () => {
  it("THE $4,624,697.31 LAZY INVENTORY ENTRY cannot auto-post", () => {
    // The original plug was a single enormous inventory adjustment typed to make
    // a balance agree. Three independent defences must each stop it: inventory
    // is not an automatable kind, it is far over any sane ceiling, and it has no
    // approved template. Rule 19 requires checking that a defence covers EVERY
    // instance of the pattern, so all three are asserted.
    const plug = goodRequest({
      sourceKind: "inventory",
      sourceRef: "LAZY-INVENTORY-ENTRY",
      amountCents: 462_469_731,
      expectedCents: null,
      templateCode: null,
    });
    expect(decidePosting(plug, null).disposition).toBe("draft");
    expect(decidePosting(plug, null).code).toBe("AUTOPOST_NOT_ELIGIBLE");

    // Even if someone built an inventory template and approved it:
    const withTemplate = decidePosting(
      { ...plug, templateCode: "INV-ADJ" },
      goodTemplate({ code: "INV-ADJ", sourceKind: "inventory" }),
    );
    expect(withTemplate.disposition).toBe("draft");

    // And even as a "bank" entry wearing a disguise, the ceiling stops it.
    const disguised = decidePosting(
      goodRequest({ amountCents: 462_469_731, expectedCents: 462_469_731 }),
      goodTemplate(),
    );
    expect(disguised.disposition).toBe("draft");
    expect(disguised.code).toBe("AUTOPOST_OVER_LIMIT");
  });

  it("a duplicated POS sale posts exactly once, however many times it is submitted", () => {
    // Webhook redelivery / double-click / replay. Ten submissions, one journal.
    const key = buildIdempotencyKey("greenway", "pos_sale", "S-2026-10-31-0042");
    const fp = fingerprintLines([
      { accountCode: "10100", amountCents: 5_000 },
      { accountCode: "50010", amountCents: -5_000 },
    ]);
    const outcomes: string[] = [];
    let stored: { idempotencyKey: string; lineFingerprint: string } | null = null;
    for (let i = 0; i < 10; i++) {
      const o = classifyIdempotency(key, fp, stored);
      outcomes.push(o);
      if (o === "fresh") stored = { idempotencyKey: key, lineFingerprint: fp };
    }
    expect(outcomes.filter((o) => o === "fresh").length).toBe(1);
    expect(outcomes.filter((o) => o === "duplicate").length).toBe(9);
  });

  it("a backwards sign on a card entry does not sail through on magnitude alone", () => {
    // One of the historical bugs was a card total booked with the wrong sign.
    // The fingerprint must treat +5000 and -5000 as different entries, so a
    // sign flip on a resubmission surfaces as a CONFLICT, not a duplicate.
    const key = buildIdempotencyKey("greenway", "bank", "CARD-2026-10-31");
    const right = fingerprintLines([{ accountCode: "10120", amountCents: 5_000 }]);
    const flipped = fingerprintLines([{ accountCode: "10120", amountCents: -5_000 }]);
    expect(right).not.toBe(flipped);
    expect(
      classifyIdempotency(key, flipped, { idempotencyKey: key, lineFingerprint: right }),
    ).toBe("conflict");
  });

  it("an intercompany transfer between Michael's own books always waits for him", () => {
    // ~24 entries a year. Automating it would save minutes and risk the balance
    // sheet, which is the worst trade available.
    for (const entity of ["greenway", "atm", "landholding", "personal"] as const) {
      const d = decidePosting(
        goodRequest({ sourceKind: "intercompany", entityCode: entity, threeWayMatched: true }),
        goodTemplate({ sourceKind: "intercompany", entityCode: entity }),
      );
      expect(d.disposition, `intercompany auto-posted for ${entity}`).toBe("draft");
    }
  });

  it("cannabis excise never rides in on a template it does not belong to", () => {
    // RCW 69.50.535(4): excise is held in trust, never revenue, never expense.
    // A template built for utilities must not be usable to post excise.
    const d = decidePosting(
      goodRequest({ sourceKind: "excise", templateCode: "UTIL-PSE" }),
      goodTemplate({ code: "UTIL-PSE", sourceKind: "bank" }),
    );
    expect(d.disposition).toBe("refuse");
    expect(d.code).toBe("AUTOPOST_WRONG_SOURCE_KIND");
  });

  it("the opening balance — the foundation of every future number — never automates", () => {
    const d = decidePosting(
      goodRequest({
        sourceKind: "opening_balance",
        journalDate: "2025-12-31",
        threeWayMatched: true,
      }),
      goodTemplate({ sourceKind: "opening_balance" }),
    );
    expect(d.disposition).toBe("draft");
    expect(d.code).toBe("AUTOPOST_NOT_ELIGIBLE");
  });
});
